"""
AMAT Dataset Explorer – FastAPI backend entry point.
"""
import io
import os
import re
from pathlib import Path

import pandas as pd
from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from google import genai
from google.genai import types
from pydantic import BaseModel

# Support .env at the project root (CWD when running uvicorn) or inside backend/
load_dotenv()
load_dotenv(Path(__file__).parent / ".env")

app = FastAPI(title="AMAT Dataset Explorer")

# Lock down to the deployed frontend origin via ALLOWED_ORIGINS
# (comma-separated); defaults to permissive for local development.
_allowed_origins = [
    origin.strip()
    for origin in os.getenv("ALLOWED_ORIGINS", "*").split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

_MAX_UPLOAD_BYTES = 50 * 1024 * 1024  # 50 MB
_MAX_CONTEXT_ROWS = 100
_GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.5-flash")

_BINARY_MIME_PREFIXES = ("image/", "audio/", "video/", "application/pdf")


class _DataStore:
    """Single active dataset, shared across all requests within the process."""

    def __init__(self) -> None:
        self.df: pd.DataFrame | None = None
        self.filename: str | None = None


store = _DataStore()


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Upload
# ---------------------------------------------------------------------------

@app.post("/upload")
async def upload_dataset(file: UploadFile = File(...)) -> dict:
    """Accept a CSV file, validate it thoroughly, parse it, and store it in memory."""
    filename = file.filename or ""

    if not filename.lower().endswith(".csv"):
        raise HTTPException(
            status_code=400,
            detail="Only .csv files are accepted. Rename the file if necessary.",
        )

    content_type = (file.content_type or "").lower().split(";")[0].strip()
    if any(content_type.startswith(prefix) for prefix in _BINARY_MIME_PREFIXES):
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported media type '{content_type}'. Upload a plain CSV file.",
        )

    content = await file.read()

    if not content:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    if len(content) > _MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File size exceeds the {_MAX_UPLOAD_BYTES // (1024 * 1024)} MB limit.",
        )

    try:
        df = pd.read_csv(io.BytesIO(content))
    except pd.errors.EmptyDataError:
        raise HTTPException(
            status_code=400,
            detail="CSV file contains no data or column headers.",
        )
    except pd.errors.ParserError as exc:
        raise HTTPException(
            status_code=422,
            detail=f"Malformed CSV – could not parse the file: {exc}",
        )
    except UnicodeDecodeError:
        raise HTTPException(
            status_code=422,
            detail=(
                "File contains non-UTF-8 characters. "
                "Re-save the CSV as UTF-8 and try again."
            ),
        )
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Could not process the file: {exc}")

    if df.empty:
        raise HTTPException(
            status_code=400,
            detail="CSV has column headers but no data rows.",
        )

    store.df = df
    store.filename = filename

    return {
        "filename": filename,
        "rows": len(df),
        "columns": list(df.columns),
        "dtypes": {col: str(dtype) for col, dtype in df.dtypes.items()},
    }


# ---------------------------------------------------------------------------
# Rows
# ---------------------------------------------------------------------------

@app.get("/rows")
def get_rows(
    limit: int = Query(default=100, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
) -> dict:
    """Return a paginated slice of the active dataset as an array of row objects."""
    if store.df is None:
        raise HTTPException(
            status_code=404,
            detail="No dataset loaded. Call POST /upload first.",
        )

    df = store.df
    total = len(df)
    page = df.iloc[offset : offset + limit]
    # NaN and ±inf are not valid JSON — replace with null before serializing
    page = page.replace([float("inf"), float("-inf")], None)
    records = page.where(pd.notnull(page), other=None).to_dict(orient="records")

    return {"total": total, "offset": offset, "limit": limit, "rows": records}


# ---------------------------------------------------------------------------
# Ask
# ---------------------------------------------------------------------------

def _build_dataset_context(df: pd.DataFrame, filename: str) -> str:
    parts = [
        f"Filename: {filename}",
        f"Shape: {len(df)} rows × {len(df.columns)} columns",
        f"\nColumn names and dtypes:\n{df.dtypes.to_string()}",
    ]

    numeric_cols = df.select_dtypes(include="number")
    if not numeric_cols.empty:
        parts.append(
            f"\nSummary statistics (numeric columns):\n{numeric_cols.describe().to_string()}"
        )

    sample_size = min(len(df), _MAX_CONTEXT_ROWS)
    parts.append(
        f"\nData sample ({sample_size} of {len(df)} rows):\n"
        f"{df.head(sample_size).to_string(index=False)}"
    )

    return "\n".join(parts)


def _strip_latex(text: str) -> str:
    """Convert LaTeX math the model may emit despite instructions into plain text."""

    def _clean(expr: str) -> str:
        def _frac(match: re.Match) -> str:
            num, den = match.group(1).strip(), match.group(2).strip()
            if " " in num:
                num = f"({num})"
            if " " in den:
                den = f"({den})"
            return f"{num} / {den}"

        expr = re.sub(r"\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}", _frac, expr)
        expr = re.sub(r"\\(?:text|textbf|mathrm|mathbf|operatorname)\s*\{([^{}]*)\}", r"\1", expr)
        for command, symbol in {
            r"\times": "×", r"\cdot": "·", r"\div": "÷", r"\pm": "±",
            r"\approx": "≈", r"\neq": "≠", r"\leq": "≤", r"\geq": "≥",
            r"\%": "%", r"\$": "$", r"\,": " ", r"\;": " ",
        }.items():
            expr = expr.replace(command, symbol)
        expr = re.sub(r"\\[a-zA-Z]+", "", expr)  # drop any remaining commands
        expr = expr.replace("{", "").replace("}", "")
        return re.sub(r"[ \t]{2,}", " ", expr).strip()

    # display math ($$...$$ / \[...\]) — cleaned expression, bolded
    text = re.sub(r"\$\$(.+?)\$\$", lambda m: f"**{_clean(m.group(1))}**", text, flags=re.S)
    text = re.sub(r"\\\[(.+?)\\\]", lambda m: f"**{_clean(m.group(1))}**", text, flags=re.S)
    # inline math: \(...\) always; $...$ only when it contains a LaTeX command,
    # so currency amounts like "$5.20" are left untouched
    text = re.sub(r"\\\((.+?)\\\)", lambda m: _clean(m.group(1)), text)
    text = re.sub(r"\$([^$\n]*\\[^$\n]*)\$", lambda m: _clean(m.group(1)), text)
    return text


class AskRequest(BaseModel):
    question: str


@app.post("/ask")
def ask(body: AskRequest) -> dict:
    """Accept a natural-language question about the active dataset and return an AI answer."""
    if store.df is None:
        raise HTTPException(
            status_code=404,
            detail="No dataset loaded. Call POST /upload first.",
        )

    if not body.question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty.")

    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail="GEMINI_API_KEY environment variable is not set.",
        )

    context = _build_dataset_context(store.df, store.filename or "dataset.csv")

    system_prompt = (
        "You are a data analyst assistant. "
        "The user has uploaded a CSV dataset and wants insights or answers about it. "
        "Answer questions accurately and concisely based on the data provided. "
        "If a calculation or aggregation is needed, show your work. "
        "If you cannot determine something from the data shown, say so clearly. "
        "Format answers as plain GitHub-flavored Markdown. Never use LaTeX or math "
        "delimiters such as $...$, $$...$$, \\frac, or \\text — the interface cannot "
        "render them. Write formulas in plain text instead, e.g. "
        "Average = (342.5 + 120.2) / 2 = 231.35, using **bold** for emphasis."
    )

    user_message = f"Dataset context:\n\n{context}\n\nQuestion: {body.question}"

    try:
        client = genai.Client(api_key=api_key)
        response = client.models.generate_content(
            model=_GEMINI_MODEL,
            contents=user_message,
            config=types.GenerateContentConfig(
                system_instruction=system_prompt,
                max_output_tokens=4096,
            ),
        )
    except Exception as exc:
        # 502: the failure is in the upstream LLM service, not this API
        raise HTTPException(status_code=502, detail=f"LLM request failed: {exc}")

    answer_text = _strip_latex(response.text or "")
    usage_meta = response.usage_metadata

    return {
        "question": body.question,
        "answer": answer_text,
        "model": _GEMINI_MODEL,
        "usage": {
            "input_tokens": usage_meta.prompt_token_count if usage_meta else 0,
            "output_tokens": usage_meta.candidates_token_count if usage_meta else 0,
        },
    }

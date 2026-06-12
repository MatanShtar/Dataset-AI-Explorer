import "./UploadSection.css";

export default function UploadSection({ status, error, compact = false, onReplaceClick }) {
  return (
    <section
      className={`upload-section ${compact ? "upload-section--compact" : "upload-section--centered"}`}
    >
      <div
        className="upload-dropzone"
        // State 2 only: clicking the compact button opens the file dialog.
        // stopPropagation keeps the click from also reaching the app-root handler.
        onClick={compact ? (e) => { e.stopPropagation(); onReplaceClick?.() } : undefined}
      >
        <span
          className={`upload-dropzone__label${
            status === "uploading" ? " upload-dropzone__label--busy" : ""
          }`}
        >
          {status === "uploading" ? (
            "Uploading…"
          ) : compact ? (
            "Replace file"
          ) : (
            <div className="upload-dropzone__stack">
              <span>Drop CSV file</span>
              <span className="upload-dropzone__sublabel">OR</span>
              <span>Click to browse</span>
            </div>
          )}
        </span>
      </div>

      {status === "error" && (
        <p className="upload-feedback upload-feedback--error">
          {error}
        </p>
      )}
    </section>
  );
}

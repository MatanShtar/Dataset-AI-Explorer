import { useState, useEffect } from 'react'
import { fetchRows } from '../api'
import './DataTable.css'

const PAGE_SIZE = 100

// up to 3 decimal places, trailing zeros trimmed
function formatCell(value) {
  if (value === null) return ''
  if (typeof value === 'number' && !Number.isInteger(value)) {
    return String(Math.round(value * 1000) / 1000)
  }
  return String(value)
}

export default function DataTable({ dataset }) {
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [slideDir, setSlideDir] = useState(0) // 1 = next, -1 = previous, 0 = no slide

  // Reset to page 1 whenever a new dataset is loaded
  useEffect(() => {
    setOffset(0)
    setSlideDir(0)
  }, [dataset])

  useEffect(() => {
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const data = await fetchRows({ limit: PAGE_SIZE, offset })
        setRows(data.rows)
        setTotal(data.total)
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [dataset, offset])

  // column order from the loaded rows; falls back to the upload
  // response metadata so headers render while the first page loads
  const columns = rows.length > 0 ? Object.keys(rows[0]) : (dataset?.columns ?? [])

  return (
    <section className="datatable-section">
      {loading && (
        <div className="datatable-loading" aria-label="Loading rows">
          {Array.from({ length: 8 }, (_, i) => (
            <span key={i} className="skeleton-line" />
          ))}
        </div>
      )}

      {error && (
        <div className="datatable-error">
          <span>{error}</span>
        </div>
      )}

      {!loading && !error && (
        <div
          className={`datatable-scroll${
            slideDir === 1
              ? ' datatable-scroll--next'
              : slideDir === -1
                ? ' datatable-scroll--prev'
                : ''
          }`}
        >
          <table className="datatable">
            <thead>
              <tr className="datatable__header-row">
                {columns.map((col) => (
                  <th key={col} className="datatable__th">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="datatable__row">
                  {columns.map((col) => (
                    <td key={col} className="datatable__td">
                      {formatCell(row[col])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="datatable-pagination">
        <button
          className="datatable-pagination__btn"
          onClick={() => {
            setSlideDir(-1)
            setOffset((o) => Math.max(0, o - PAGE_SIZE))
          }}
          disabled={offset === 0}
        >
          Previous
        </button>

        <span className="datatable-pagination__info">
          {total > 0
            ? `Rows ${offset + 1}–${Math.min(offset + PAGE_SIZE, total)} of ${total}`
            : ''}
        </span>

        <button
          className="datatable-pagination__btn"
          onClick={() => {
            setSlideDir(1)
            setOffset((o) => o + PAGE_SIZE)
          }}
          disabled={offset + PAGE_SIZE >= total}
        >
          Next
        </button>
      </div>
    </section>
  )
}

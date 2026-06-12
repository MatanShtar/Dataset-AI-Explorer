import { useState, useRef, useEffect } from 'react'
import { uploadDataset } from './api'
import UploadSection from './components/UploadSection'
import DataTable from './components/DataTable'
import ChatInterface from './components/ChatInterface'
import './App.css'

export default function App() {
  const [dataset, setDataset] = useState(null)
  const [uploadStatus, setUploadStatus] = useState('idle') // 'idle' | 'uploading' | 'success' | 'error'
  const [uploadError, setUploadError] = useState(null)
  const [isDragging, setIsDragging] = useState(false)
  const inputRef = useRef(null)
  // dragenter/dragleave fire for every child node crossed; a counter
  // (instead of a boolean) keeps the overlay from flickering
  const dragCounter = useRef(0)
  const hasDataset = dataset !== null

  async function handleFile(file) {
    if (!file) return
    setUploadStatus('uploading')
    setUploadError(null)
    try {
      const result = await uploadDataset(file)
      setUploadStatus('success')
      setDataset(result)
    } catch (err) {
      setUploadStatus('error')
      setUploadError(err.message)
    }
  }

  // Prevent Chrome from navigating/downloading files dropped outside the dropzone
  useEffect(() => {
    function prevent(e) { e.preventDefault() }
    document.addEventListener('dragover', prevent)
    document.addEventListener('drop', prevent)
    return () => {
      document.removeEventListener('dragover', prevent)
      document.removeEventListener('drop', prevent)
    }
  }, [])

  function handleDragEnter(e) {
    e.preventDefault()
    dragCounter.current++
    if (e.dataTransfer.types.includes('Files')) setIsDragging(true)
  }

  function handleDragLeave() {
    dragCounter.current--
    if (dragCounter.current === 0) setIsDragging(false)
  }

  function handleDragOver(e) {
    e.preventDefault()
  }

  function handleDrop(e) {
    e.preventDefault()
    dragCounter.current = 0
    setIsDragging(false)
    handleFile(e.dataTransfer.files[0])
  }

  return (
    <div
      className={[
        'app-root',
        hasDataset ? 'app-root--loaded' : 'app-root--empty',
        isDragging ? 'app-root--dragging' : '',
      ].join(' ')}
      // State 1 only: clicking anywhere opens the file dialog
      onClick={!hasDataset ? () => inputRef.current?.click() : undefined}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Single hidden input — shared by whole-screen click (state 1) and Replace button (state 2) */}
      <input
        ref={inputRef}
        type="file"
        accept=".csv"
        style={{ display: 'none' }}
        onChange={(e) => handleFile(e.target.files[0])}
      />

      <UploadSection
        status={uploadStatus}
        error={uploadError}
        compact={hasDataset}
        onReplaceClick={() => inputRef.current?.click()}
      />

      {hasDataset && (
        <div className="app-content">
          <div className="app-content__table">
            <DataTable dataset={dataset} />
          </div>
          <div className="app-content__chat">
            <ChatInterface />
          </div>
        </div>
      )}

      {isDragging && <div className="drag-overlay" aria-hidden="true" />}
    </div>
  )
}

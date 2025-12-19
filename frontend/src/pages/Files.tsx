import { ChangeEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  FileEntry,
  deleteEntry,
  downloadFile,
  listFiles,
  readFile,
  uploadFile,
  writeFile,
} from '../api/files'

const joinPath = (base: string, name: string) =>
  [base, name].filter(Boolean).join('/').replace(/\/+/g, '/')

export function FilesPage() {
  const { id } = useParams()
  const controllerRef = useRef<AbortController | null>(null)
  const [currentPath, setCurrentPath] = useState('')
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [fileContent, setFileContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const uploadRef = useRef<HTMLInputElement | null>(null)

  const resolveError = (err: unknown, fallback: string) => {
    if (err && typeof err === 'object' && 'status' in err && typeof err.status === 'number') {
      const status = err.status as number
      if (status === 404) {
        const data = (err as { data?: unknown }).data
        const errorText =
          data && typeof data === 'object'
            ? String((data as { error?: unknown; message?: unknown }).error ??
                (data as { error?: unknown; message?: unknown }).message ?? '')
            : ''
        if (!errorText || /not found/i.test(errorText)) {
          return 'Files API not implemented'
        }
        return errorText
      }
    }

    if (err instanceof Error) return err.message
    return fallback
  }

  const pathSegments = useMemo(
    () => currentPath.split('/').filter((segment) => segment.length > 0),
    [currentPath],
  )

  const loadEntries = async () => {
    if (!id) {
      setError('Missing instance id')
      setEntries([])
      return
    }

    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller

    setLoading(true)
    setError(null)
    setFeedback(null)
    try {
      // Backend endpoint: GET /api/instances/:id/files?path={path}
      const data = await listFiles(id, currentPath || '/', controller.signal)
      setEntries(data)
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        return
      }
      const message = resolveError(err, 'Failed to load files')
      setError(message)
      setEntries([])
      if (/invalid path/i.test(message) && currentPath) {
        setCurrentPath((prev) => prev.split('/').slice(0, -1).join('/'))
      }
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false)
      }
    }
  }

  useEffect(() => {
    loadEntries()

    return () => {
      controllerRef.current?.abort()
    }
  }, [id, currentPath])

  const openFile = async (name: string) => {
    if (!id) return
    const path = joinPath(currentPath, name)
    setSelectedFile(path)
    setFeedback(null)
    setError(null)
    try {
      const content = await readFile(id, path)
      setFileContent(content)
    } catch (err) {
      setError(resolveError(err, 'Failed to read file'))
      setSelectedFile(null)
      setFileContent('')
    }
  }

  const handleSaveFile = async () => {
    if (!id || !selectedFile) return
    setSaving(true)
    setFeedback(null)
    setError(null)
    try {
      await writeFile(id, selectedFile, fileContent)
      setFeedback('Saved file successfully.')
    } catch (err) {
      setError(resolveError(err, 'Failed to save file'))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (name: string) => {
    if (!id) return
    const path = joinPath(currentPath, name)
    setError(null)
    setFeedback(null)
    try {
      await deleteEntry(id, path)
      if (selectedFile === path) {
        setSelectedFile(null)
        setFileContent('')
      }
      await loadEntries()
      setFeedback('Deleted successfully.')
    } catch (err) {
      setError(resolveError(err, 'Delete failed'))
    }
  }

  const handleDownload = async (name: string) => {
    if (!id) return
    const path = joinPath(currentPath, name)
    try {
      const blob = await downloadFile(id, path)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = name
      link.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(resolveError(err, 'Download failed'))
    }
  }

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    if (!id || !event.target.files?.length) return
    const file = event.target.files[0]
    setError(null)
    setFeedback(null)
    try {
      await uploadFile(id, currentPath, file)
      await loadEntries()
      setFeedback('Upload complete.')
    } catch (err) {
      setError(resolveError(err, 'Upload failed'))
    } finally {
      event.target.value = ''
    }
  }

  const handleEnterDirectory = (name: string) => {
    setSelectedFile(null)
    setFileContent('')
    setCurrentPath((prev) => joinPath(prev, name))
  }

  const handleRowKeyDown = (event: KeyboardEvent<HTMLDivElement>, action: () => void) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      action()
    }
  }

  const handleGoUp = () => {
    const segments = [...pathSegments]
    segments.pop()
    setSelectedFile(null)
    setFileContent('')
    setCurrentPath(segments.join('/'))
  }

  return (
    <section className="page">
      <div className="page__header page__header--spread">
        <div>
          <h1>Files</h1>
          {id ? <span className="page__id">Instance: {id}</span> : null}
          <div className="breadcrumbs">
            <span className="breadcrumb" onClick={() => setCurrentPath('')} role="button">
              /
            </span>
            {pathSegments.map((segment, index) => {
              const path = pathSegments.slice(0, index + 1).join('/')
              return (
                <span key={path}>
                  <span className="breadcrumb-separator">/</span>
                  <span
                    className="breadcrumb"
                    onClick={() => setCurrentPath(path)}
                    role="button"
                  >
                    {segment}
                  </span>
                </span>
              )
            })}
          </div>
        </div>
        <div className="actions">
          <button className="btn btn--ghost" onClick={loadEntries} disabled={loading}>
            {loading ? 'Loading…' : 'Reload'}
          </button>
          <button
            className="btn"
            onClick={() => uploadRef.current?.click()}
            disabled={loading}
          >
            Upload
          </button>
          <input
            ref={uploadRef}
            type="file"
            className="sr-only"
            onChange={handleUpload}
          />
        </div>
      </div>

      {error ? (
        <div className="alert alert--error alert--flex">
          <span>{error}</span>
          <button className="btn btn--ghost" onClick={loadEntries} disabled={loading}>
            Retry
          </button>
        </div>
      ) : null}
      {feedback ? <div className="alert alert--muted">{feedback}</div> : null}
      {loading ? <div className="alert alert--muted">Loading files…</div> : null}

      <div className="files">
        <div className="files__list">
          <div className="files__header">
            <span>Name</span>
            <span>Actions</span>
          </div>
          {currentPath ? (
            <div
              className="files__item"
              tabIndex={0}
              role="button"
              onKeyDown={(event) => handleRowKeyDown(event, handleGoUp)}
              onClick={handleGoUp}
            >
              <span className="files__name">..</span>
              <span className="files__actions">Up</span>
            </div>
          ) : null}
          {entries
            .slice()
            .sort((a, b) => {
              if (a.type === b.type) return a.name.localeCompare(b.name)
              return a.type === 'directory' ? -1 : 1
            })
            .map((entry) => (
              <div
                key={entry.path || entry.name}
                className="files__item"
                tabIndex={0}
                role="button"
                onKeyDown={(event) =>
                  handleRowKeyDown(event, () =>
                    entry.type === 'directory'
                      ? handleEnterDirectory(entry.name)
                      : openFile(entry.name),
                  )
                }
                onClick={() =>
                  entry.type === 'directory' ? handleEnterDirectory(entry.name) : openFile(entry.name)
                }
              >
                <span className="files__name">
                  {entry.type === 'directory' ? '📁' : '📄'} {entry.name}
                </span>
                <span className="files__actions">
                  <button
                    className="btn btn--ghost"
                    onClick={(event) => {
                      event.stopPropagation()
                      if (entry.type === 'directory') {
                        handleEnterDirectory(entry.name)
                      } else {
                        openFile(entry.name)
                      }
                    }}
                  >
                    Open
                  </button>
                  <button
                    className="btn btn--ghost"
                    onClick={(event) => {
                      event.stopPropagation()
                      handleDownload(entry.name)
                    }}
                  >
                    Download
                  </button>
                  <button
                    className="btn btn--ghost"
                    onClick={(event) => {
                      event.stopPropagation()
                      handleDelete(entry.name)
                    }}
                  >
                    Delete
                  </button>
                </span>
              </div>
            ))}
          {entries.length === 0 && !loading ? (
            <div className="empty">No files in this directory.</div>
          ) : null}
        </div>

        {selectedFile ? (
          <div className="files__editor">
            <div className="files__editor-header">
              <h3>{selectedFile}</h3>
              <button className="btn" onClick={handleSaveFile} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
            <textarea
              className="textarea"
              value={fileContent}
              spellCheck={false}
              onChange={(event) => setFileContent(event.target.value)}
              rows={20}
            />
          </div>
        ) : (
          <div className="files__placeholder">Select a text file to view or edit.</div>
        )}
      </div>
    </section>
  )
}

export default FilesPage

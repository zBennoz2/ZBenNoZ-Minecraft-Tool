import { FormEvent, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import BackButton from '../components/BackButton'
import { addWhitelistEntry, getWhitelist, removeWhitelistEntry, WhitelistEntry } from '../api'

export function WhitelistPage() {
  const { id } = useParams()
  const [entries, setEntries] = useState<WhitelistEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [addName, setAddName] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [filter, setFilter] = useState('')
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const filteredEntries = useMemo(() => {
    const term = filter.trim().toLowerCase()
    if (!term) return entries
    return entries.filter((entry) => entry.name.toLowerCase().includes(term))
  }, [entries, filter])

  const refresh = async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    setSuccessMessage(null)
    try {
      const list = await getWhitelist(id)
      setEntries(list)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load whitelist'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [id])

  const handleAdd = async (event: FormEvent) => {
    event.preventDefault()
    if (!id) return
    const trimmed = addName.trim()
    if (!trimmed) {
      setAddError('Player name is required')
      return
    }
    setBusy(true)
    setAddError(null)
    try {
      const updated = await addWhitelistEntry(id, trimmed)
      setEntries(updated)
      setAddName('')
      setSuccessMessage(`Added ${trimmed} to whitelist.`)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to add player'
      setAddError(message)
    } finally {
      setBusy(false)
    }
  }

  const handleRemove = async (name: string) => {
    if (!id) return
    const confirmed = window.confirm(`Remove ${name} from whitelist?`)
    if (!confirmed) return
    setBusy(true)
    setSuccessMessage(null)
    try {
      const updated = await removeWhitelistEntry(id, name)
      setEntries(updated)
      setSuccessMessage(`Removed ${name} from whitelist.`)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to remove player'
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="page">
      <div className="page__toolbar">
        <BackButton fallback={id ? `/instances/${id}/console` : '/'} />
      </div>
      <div className="page__header page__header--spread">
        <div>
          <h1>Whitelist</h1>
          <p className="page__hint">Control which players can join this server.</p>
          {id ? <p className="page__id">Instance {id}</p> : null}
        </div>
        <div className="actions actions--inline">
          <Link className="btn btn--ghost" to={`/instances/${id}/console`}>
            Back to Console
          </Link>
          <button className="btn btn--ghost" onClick={refresh} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      <form className="form" onSubmit={handleAdd}>
        <label className="form__field">
          <span>Add player</span>
          <div className="form__inline">
            <input
              type="text"
              value={addName}
              onChange={(event) => setAddName(event.target.value)}
              placeholder="Player name"
              disabled={busy}
            />
            <button className="btn" type="submit" disabled={busy}>
              {busy ? 'Working…' : 'Add'}
            </button>
          </div>
        </label>
        {addError ? <div className="alert alert--error">{addError}</div> : null}
        {successMessage ? <div className="alert alert--muted">{successMessage}</div> : null}
      </form>

      <div className="whitelist__toolbar">
        <input
          className="input"
          type="search"
          placeholder="Search players"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          disabled={loading}
        />
        <span className="whitelist__count">{entries.length} total</span>
      </div>

      {error ? <div className="alert alert--error">{error}</div> : null}
      {loading ? <div className="alert alert--muted">Loading whitelist…</div> : null}
      {!loading && entries.length === 0 ? <div className="empty">Whitelist is empty.</div> : null}

      {filteredEntries.length > 0 ? (
        <div className="table">
          <div className="table__head">
            <div>Player</div>
            <div>UUID</div>
            <div>Actions</div>
          </div>
          <div className="table__body">
            {filteredEntries.map((entry) => (
              <div key={`${entry.name}-${entry.uuid ?? 'nouuid'}`} className="table__row">
                <div className="table__cell">{entry.name}</div>
                <div className="table__cell">{entry.uuid ?? '—'}</div>
                <div className="table__cell table__cell--actions">
                  <button
                    className="btn btn--ghost"
                    onClick={() => handleRemove(entry.name)}
                    disabled={busy}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  )
}

export default WhitelistPage

import { useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

interface BackButtonProps {
  fallback?: string
  label?: string
}

export function BackButton({ fallback = '/', label = 'Back' }: BackButtonProps) {
  const navigate = useNavigate()
  const location = useLocation()

  const canGoBack = useMemo(() => {
    const state = window.history.state as { idx?: number } | null
    return typeof state?.idx === 'number' && state.idx > 0
  }, [location.key])

  const handleBack = () => {
    if (canGoBack) {
      navigate(-1)
      return
    }
    navigate(fallback)
  }

  return (
    <button className="btn btn--ghost back-button" type="button" onClick={handleBack}>
      <span className="back-button__icon" aria-hidden>
        ←
      </span>
      <span>{label}</span>
    </button>
  )
}

export default BackButton

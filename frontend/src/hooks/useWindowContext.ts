import { useMemo } from 'react'
import { useLocation } from 'react-router-dom'

export type WindowContext = {
  windowType: string | null
  instanceId: string | null
  isInstanceWindow: boolean
  instanceSearch: string
}

export function useWindowContext(): WindowContext {
  const { search } = useLocation()

  return useMemo(() => {
    const params = new URLSearchParams(search)
    const windowType = params.get('windowType')
    const instanceId = params.get('instanceId')
    const isInstanceWindow = windowType === 'instance'
    const instanceSearch = isInstanceWindow && params.toString() ? `?${params.toString()}` : ''

    return {
      windowType,
      instanceId,
      isInstanceWindow,
      instanceSearch,
    }
  }, [search])
}

export default useWindowContext

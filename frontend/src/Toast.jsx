import { createContext, useCallback, useContext, useRef, useState } from 'react'

const ToastContext = createContext(() => {})

export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null)
  const timer = useRef(null)

  const show = useCallback((message, kind = 'info') => {
    clearTimeout(timer.current)
    setToast({ message, kind })
    timer.current = setTimeout(() => setToast(null), 5000)
  }, [])

  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast && <div className={`toast ${toast.kind}`}>{toast.message}</div>}
    </ToastContext.Provider>
  )
}

export const useToast = () => useContext(ToastContext)

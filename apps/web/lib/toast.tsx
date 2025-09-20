// Toast utility for managing notifications
import { useState } from 'react'

export type ToastType = 'info' | 'success' | 'error'

export type Toast = {
  id: string
  message: string
  type: ToastType
  icon: string
}

// Custom hook for toast management
export const useToast = () => {
  const [toasts, setToasts] = useState<Toast[]>([])

  const addToast = (message: string, type: ToastType, icon: string, duration: number = 3000) => {
    const id = Date.now().toString()
    setToasts(prev => [...prev, { id, message, type, icon }])
    
    setTimeout(() => {
      setToasts(prev => prev.filter(toast => toast.id !== id))
    }, duration)
  }

  const removeToast = (id: string) => {
    setToasts(prev => prev.filter(toast => toast.id !== id))
  }

  return {
    toasts,
    addToast,
    removeToast,
    showWaitToast: () => addToast('Please wait, AI is still responding...', 'info', '⏳'),
    showSuccessToast: (message: string) => addToast(message, 'success', '🏠'),
    showErrorToast: (message: string) => addToast(message, 'error', '❌'),
    showCreateRoomToast: () => addToast('Creating room...', 'info', '🏗️')
  }
}

// Toast component
export const ToastContainer = ({ toasts }: { toasts: Toast[] }) => {
  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col-reverse space-y-reverse space-y-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`
            transform transition-all duration-300 ease-in-out animate-in slide-in-from-bottom-2
            px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 min-w-64
            ${toast.type === 'success' ? 'bg-green-600 text-white' : 
              toast.type === 'error' ? 'bg-red-600 text-white' : 
              'bg-primary text-primary-foreground'}
          `}
        >
          <span className="text-lg">{toast.icon}</span>
          <span className="text-sm font-medium flex-1">{toast.message}</span>
        </div>
      ))}
    </div>
  )
}

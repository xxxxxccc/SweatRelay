import { Toaster as Sonner, type ToasterProps } from 'sonner'

const Toaster = (props: ToasterProps) => {
  return (
    <Sonner
      theme="system"
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            'group toast group-[.toaster]:bg-surface group-[.toaster]:text-fg group-[.toaster]:border-border group-[.toaster]:shadow-lg',
          description: 'group-[.toast]:text-fg-muted',
          actionButton: 'group-[.toast]:bg-accent group-[.toast]:text-accent-fg',
          cancelButton: 'group-[.toast]:bg-surface-2 group-[.toast]:text-fg',
        },
      }}
      {...props}
    />
  )
}

export { Toaster }

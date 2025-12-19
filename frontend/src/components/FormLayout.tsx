import { ReactNode } from 'react'

interface FormSectionProps {
  title: string
  description?: ReactNode
  children: ReactNode
  actions?: ReactNode
}

export function FormSection({ title, description, children, actions }: FormSectionProps) {
  return (
    <section className="form-section">
      <header className="form-section__header">
        <div>
          <h2>{title}</h2>
          {description ? <p className="form-section__description">{description}</p> : null}
        </div>
        {actions ? <div className="form-section__actions">{actions}</div> : null}
      </header>
      <div className="form-grid">{children}</div>
    </section>
  )
}

interface FormRowProps {
  label: ReactNode
  children: ReactNode
  help?: ReactNode
  alignTop?: boolean
}

export function FormRow({ label, children, help, alignTop }: FormRowProps) {
  return (
    <div className={`form-row${alignTop ? ' form-row--align-start' : ''}`}>
      <div className="form-label">{label}</div>
      <div className="form-control">
        {children}
        {help ? <p className="form-help">{help}</p> : null}
      </div>
    </div>
  )
}

interface FormToggleProps {
  label: ReactNode
  description?: ReactNode
  checked: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
}

export function FormToggle({ label, description, checked, onChange, disabled }: FormToggleProps) {
  return (
    <label className="form-toggle">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} disabled={disabled} />
      <div>
        <span className="form-toggle__label">{label}</span>
        {description ? <p className="form-help">{description}</p> : null}
      </div>
    </label>
  )
}

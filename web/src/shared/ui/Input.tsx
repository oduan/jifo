import { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';

type FieldProps = {
  label: ReactNode;
  children: ReactNode;
  className?: string;
};

export function Field({ label, children, className = '' }: FieldProps) {
  return (
    <label className={['jifo-field', className].filter(Boolean).join(' ')}>
      <span>{label}</span>
      {children}
    </label>
  );
}

export function TextInput({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={['jifo-input', className].filter(Boolean).join(' ')} {...props} />;
}

export function Textarea({ className = '', ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={['jifo-textarea', className].filter(Boolean).join(' ')} {...props} />;
}

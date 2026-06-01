import { forwardRef, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';

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

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className = '', ...props }, ref) {
  return <textarea ref={ref} className={['jifo-textarea', className].filter(Boolean).join(' ')} {...props} />;
});

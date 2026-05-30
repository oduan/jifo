import { ButtonHTMLAttributes, ReactNode } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  children: ReactNode;
};

export function Button({ variant = 'secondary', className = '', children, ...props }: ButtonProps) {
  const variantClass = variant === 'primary' ? 'jifo-button--primary' : variant === 'ghost' ? 'jifo-button--ghost' : '';
  return (
    <button className={['jifo-button', variantClass, className].filter(Boolean).join(' ')} {...props}>
      {children}
    </button>
  );
}

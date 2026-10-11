'use client';

import * as React from 'react';
import { useFormContext, type FieldPath, type FieldValues } from 'react-hook-form';
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input, type InputProps } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { getInputClassName, FORM_STYLES } from '@/lib/config/form-styles';
import { PasswordVisibilityToggle } from './PasswordVisibilityToggle';

export interface FormPasswordProps<TFieldValues extends FieldValues = FieldValues> extends Omit<
  InputProps,
  'name' | 'type'
> {
  name: FieldPath<TFieldValues>;
  label?: string;
  description?: string;
  showToggle?: boolean;
}

export const FormPassword = <TFieldValues extends FieldValues = FieldValues>({
  name,
  label,
  description,
  className,
  showToggle = true,
  onChange: consumerOnChange,
  onBlur: consumerOnBlur,
  ...inputProps
}: FormPasswordProps<TFieldValues>): React.JSX.Element => {
  const [showPassword, setShowPassword] = React.useState(false);
  const { control } = useFormContext<TFieldValues>();
  const restInputProps: Record<string, unknown> = { ...inputProps };
  delete restInputProps['aria-describedby'];
  delete restInputProps['aria-invalid'];

  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => {
        const { onChange: fieldOnChange, onBlur: fieldOnBlur, ...restField } = field;
        return (
          <FormItem className={cn(FORM_STYLES.container, className)}>
            {label && <FormLabel>{label}</FormLabel>}
            <div className="relative">
              <FormControl>
                <Input
                  {...restField}
                  {...restInputProps}
                  type={showPassword ? 'text' : 'password'}
                  onChange={(e) => {
                    consumerOnChange?.(e);
                    fieldOnChange(e);
                  }}
                  onBlur={(e) => {
                    consumerOnBlur?.(e);
                    fieldOnBlur();
                  }}
                  className={cn(getInputClassName(), showToggle && 'pe-10')}
                />
              </FormControl>
              {showToggle && (
                <PasswordVisibilityToggle
                  showPassword={showPassword}
                  onToggle={() => setShowPassword((prev) => !prev)}
                />
              )}
            </div>
            {description && <FormDescription>{description}</FormDescription>}
            <FormMessage />
          </FormItem>
        );
      }}
    />
  );
};

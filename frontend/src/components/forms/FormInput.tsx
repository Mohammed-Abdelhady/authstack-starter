'use client';

import * as React from 'react';
import { type FieldPath, type FieldValues } from 'react-hook-form';
import { Input, type InputProps } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { getInputClassName } from '@/lib/config/form-styles';
import { BaseFormField } from './BaseFormField';

export interface FormInputProps<TFieldValues extends FieldValues = FieldValues> extends Omit<
  InputProps,
  'name'
> {
  name: FieldPath<TFieldValues>;
  label?: string;
  description?: string;
  containerClassName?: string;
}

export const FormInput = <TFieldValues extends FieldValues = FieldValues>({
  name,
  label,
  description,
  className,
  containerClassName,
  onChange: consumerOnChange,
  onBlur: consumerOnBlur,
  ...inputProps
}: FormInputProps<TFieldValues>): React.JSX.Element => {
  const restInputProps: Record<string, unknown> = { ...inputProps };
  delete restInputProps['aria-describedby'];
  delete restInputProps['aria-invalid'];

  return (
    <BaseFormField
      name={name}
      label={label}
      description={description}
      className={containerClassName}
      render={(field) => {
        const { onChange: fieldOnChange, onBlur: fieldOnBlur, ...restField } = field;
        return (
          <Input
            {...restField}
            {...restInputProps}
            dir={
              inputProps.type === 'email' || inputProps.autoComplete === 'one-time-code'
                ? 'ltr'
                : inputProps.dir
            }
            onChange={(e) => {
              consumerOnChange?.(e);
              fieldOnChange(e);
            }}
            onBlur={(e) => {
              consumerOnBlur?.(e);
              fieldOnBlur();
            }}
            className={cn(getInputClassName(), className)}
          />
        );
      }}
    />
  );
};

'use client';

import { useTranslations } from 'next-intl';
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { getInputClassName, FORM_STYLES } from '@/lib/config/form-styles';

export interface SelectOption {
  label: string;
  value: string;
}

export interface SelectOptionGroup {
  label: string;
  options: SelectOption[];
}

export interface FormSelectProps<TFieldValues extends FieldValues = FieldValues> {
  name: FieldPath<TFieldValues>;
  label?: string;
  description?: string;
  placeholder?: string;
  options?: SelectOption[];
  groups?: SelectOptionGroup[];
  disabled?: boolean;
  className?: string;
  onValueChange?: (value: string) => void;
}

export const FormSelect = <TFieldValues extends FieldValues = FieldValues>({
  name,
  label,
  description,
  placeholder,
  options,
  groups,
  disabled,
  className,
  onValueChange: consumerOnValueChange,
}: FormSelectProps<TFieldValues>): React.JSX.Element => {
  const t = useTranslations('common');
  const { control } = useFormContext<TFieldValues>();

  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className={cn(FORM_STYLES.container, className)}>
          {label && <FormLabel>{label}</FormLabel>}
          <Select
            onValueChange={(val) => {
              field.onChange(val);
              consumerOnValueChange?.(val);
            }}
            defaultValue={field.value}
            value={field.value}
            disabled={disabled}
          >
            <FormControl>
              <SelectTrigger className={cn(getInputClassName())}>
                <SelectValue placeholder={placeholder || t('selectOption')} />
              </SelectTrigger>
            </FormControl>
            <SelectContent>
              {groups
                ? groups.map((group) => (
                    <SelectGroup key={group.label}>
                      <SelectLabel>{group.label}</SelectLabel>
                      {group.options.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))
                : options?.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
            </SelectContent>
          </Select>
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );
};

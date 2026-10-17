import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, type DefaultValues, type FieldValues, type UseFormReturn } from 'react-hook-form';
import { type z } from 'zod/v3';

/**
 * Custom hook that sets up React Hook Form with Zod validation
 *
 * @example
 * ```tsx
 * import { useFormWithValidation } from '@/hooks/useFormWithValidation';
 * import { zodEmail, zodPassword } from '@app/core';
 * import { z } from 'zod/v3';
 *
 * const loginSchema = z.object({
 *   email: zodEmail({ required: true, messages: { required: t('emailRequired'), invalid: t('emailInvalid') } }),
 *   password: zodPassword({ required: true, messages: passwordMessages }),
 * });
 *
 * type LoginFormValues = z.infer<typeof loginSchema>;
 *
 * function LoginForm() {
 *   const form = useFormWithValidation({
 *     schema: loginSchema,
 *     defaultValues: {
 *       email: '',
 *       password: '',
 *     },
 *   });
 *
 *   const onSubmit = (data: LoginFormValues) => {
 *     console.log(data);
 *   };
 *
 *   return (
 *     <Form {...form}>
 *       <form onSubmit={form.handleSubmit(onSubmit)}>
 *         <FormInput name="email" label="Email" />
 *         <FormPassword name="password" label="Password" />
 *         <button type="submit">Login</button>
 *       </form>
 *     </Form>
 *   );
 * }
 * ```
 */
export function useFormWithValidation<
  TSchema extends z.ZodType<FieldValues, z.ZodTypeDef, FieldValues>,
>({
  schema,
  defaultValues,
  mode = 'onBlur',
  criteriaMode = 'all',
}: {
  schema: TSchema;
  defaultValues?: DefaultValues<z.infer<TSchema>>;
  mode?: 'onBlur' | 'onChange' | 'onSubmit' | 'onTouched' | 'all';
  criteriaMode?: 'firstError' | 'all';
}): UseFormReturn<z.infer<TSchema>> {
  return useForm<z.infer<TSchema>>({
    resolver: zodResolver(schema),
    defaultValues,
    mode,
    criteriaMode,
  });
}

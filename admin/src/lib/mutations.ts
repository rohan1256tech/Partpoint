import { notifications } from '@mantine/notifications';
import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { errorMessage } from '../api/client';

/**
 * A mutation that shows a success/error notification and refreshes the given queries.
 * Keeps every admin action consistent: no silent failures, no stale lists.
 */
export function useAction<TVars, TResult = unknown>(opts: {
  run: (vars: TVars) => Promise<TResult>;
  success: string | ((result: TResult, vars: TVars) => string);
  invalidate?: QueryKey[];
  onDone?: (result: TResult, vars: TVars) => void;
}) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: opts.run,
    onSuccess: (result, vars) => {
      notifications.show({
        color: 'green',
        message: typeof opts.success === 'function' ? opts.success(result, vars) : opts.success,
      });
      for (const key of opts.invalidate ?? []) void qc.invalidateQueries({ queryKey: key });
      opts.onDone?.(result, vars);
    },
    onError: (err) => notifications.show({ color: 'red', title: 'Not saved', message: errorMessage(err) }),
  });
}

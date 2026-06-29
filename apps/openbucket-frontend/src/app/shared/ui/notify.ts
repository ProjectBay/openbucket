import { toast } from 'ngx-sonner';

/**
 * Thin, framework-agnostic wrapper over ngx-sonner's `toast` so every component
 * and store fires feedback the same way (STORY-0600 / TASK-1800). The single
 * `<hlm-toaster />` mounted in `app.component.html` renders these. Pure functions
 * — no Angular DI — so stores can import them directly.
 */
type ToastOpts = Parameters<typeof toast.success>[1];

export const notify = {
  success: (message: string, opts?: ToastOpts) => toast.success(message, opts),
  error: (message: string, opts?: ToastOpts) => toast.error(message, opts),
  info: (message: string, opts?: ToastOpts) => toast(message, opts),
  /** Loading → success/error toast bound to a promise's lifecycle. */
  promise: <T>(promise: Promise<T>, msgs: { loading: string; success: string; error: string }) =>
    toast.promise(promise, msgs),
};

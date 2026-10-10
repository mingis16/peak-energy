/**
 * Settings forms are shared with the setup questions, which pass the step to
 * go to once the answers are saved.
 */
export function NextStep({ next }: { next?: string }) {
  return next ? <input type="hidden" name="next" value={next} /> : null;
}

import type { UserFacingError } from './errors';

export function ErrorMessage({ error }: { error?: UserFacingError }) {
  if (!error) return null;
  return (
    <div className="form-error" role="alert">
      <p>{error.message}</p>
      {error.details && error.details.length > 0 && (
        <details>
          <summary>Show details ({error.details.length})</summary>
          <ul>
            {error.details.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

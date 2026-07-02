export function DataView({ json }: { json: string }) {
  return (
    <div className="data-surface">
      <pre>{json}</pre>
    </div>
  );
}

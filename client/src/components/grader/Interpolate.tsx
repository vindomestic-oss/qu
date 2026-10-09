import { Fragment } from 'react';

/**
 * A translated template ("Graded by {name}, {time}") with React nodes for its placeholders, so names
 * and numbers can sit in their own <bdi> and keep their order in Hebrew (e.g. "Rav K." with its dot).
 */
export function Interpolate({ template, values }: { template: string; values: Record<string, React.ReactNode> }) {
  const parts = template.split(/\{(\w+)\}/);
  return (
    <>
      {parts.map((part, i) => (i % 2 === 1 ? <Fragment key={i}>{values[part] ?? `{${part}}`}</Fragment> : part))}
    </>
  );
}

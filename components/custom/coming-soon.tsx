import type { LucideIcon } from 'lucide-react';

interface ComingSoonProps {
  title: string;
  /** One plain sentence on what this tab will let the person do. */
  description: string;
  icon: LucideIcon;
}

/**
 * Placeholder for tabs that are routed but not built yet.
 *
 * States what the tab will do rather than just saying "coming soon", so an
 * empty screen still tells the person something useful.
 */
export function ComingSoon({ title, description, icon: Icon }: ComingSoonProps) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-6 py-24 text-center">
      <span className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl border bg-background">
        <Icon className="h-5 w-5 text-muted-foreground" />
      </span>
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
      <p className="mt-6 text-xs uppercase tracking-widest text-muted-foreground/70">
        Not built yet
      </p>
    </div>
  );
}

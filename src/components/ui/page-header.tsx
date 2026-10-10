import { cn } from "@/lib/utils";

/**
 * Standardized page header: title + description + optional right-side actions.
 * Replaces the hand-rolled h1/p blocks previously duplicated in every page.
 */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      data-slot="page-header"
      className={cn("clay-page-header flex items-start justify-between gap-4 flex-wrap", className)}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-3">
          <span className="clay-page-header__mark" aria-hidden="true" />
          <h1 className="type-h1 text-balance">{title}</h1>
        </div>
        {description && (
          <p className="mt-2 pl-[1.125rem] max-w-2xl text-sm leading-6 text-muted-foreground text-pretty">{description}</p>
        )}
      </div>
      {actions && (
        <div className="clay-page-header__actions flex items-center gap-2 shrink-0 flex-wrap">
          {actions}
        </div>
      )}
    </section>
  );
}

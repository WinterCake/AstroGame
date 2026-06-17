import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../utils/format";

type IconTextProps = {
  icon: LucideIcon;
  children?: ReactNode;
  className?: string;
  iconClassName?: string;
  size?: number;
};

export function IconText({
  icon: Icon,
  children,
  className,
  iconClassName,
  size = 16,
}: IconTextProps) {
  return (
    <span className={cn("icon-text", className)}>
      <Icon size={size} strokeWidth={2} className={cn("icon", iconClassName)} aria-hidden />
      {children}
    </span>
  );
}

type PageTitleProps = {
  icon: LucideIcon;
  children: ReactNode;
};

export function PageTitle({ icon: Icon, children }: PageTitleProps) {
  return (
    <h1 className="page-title">
      <Icon size={22} strokeWidth={2} className="icon page-title-icon" aria-hidden />
      {children}
    </h1>
  );
}

import { uiT, useUiLanguage, uiLocale } from "../../i18n/store.js";
/* eslint-disable jsx-a11y/no-redundant-roles, jsx-a11y/no-interactive-element-to-noninteractive-role -- Preserve read-only table semantics when mobile CSS uses grid and flex layouts. */
import { Children, cloneElement, createContext, forwardRef, isValidElement, useContext } from "react";
import { cn } from "../../lib/utils.js";
const Columns = createContext([]);
function textOf(children) {
  return Children.toArray(children).map(child => isValidElement(child) ? textOf(child.props.children) : typeof child === "string" || typeof child === "number" ? String(child) : "").join("");
}
export const Table = forwardRef(({
  className,
  children,
  mobileCards = true,
  mobileColumns = 2,
  ...props
}, ref) => {
  useUiLanguage();
  const header = Children.toArray(children).find(child => isValidElement(child) && child.type === TableHeader);
  const row = header && Children.toArray(header.props.children).find(child => isValidElement(child) && child.type === TableRow);
  const labels = row ? Children.toArray(row.props.children).map(cell => isValidElement(cell) ? textOf(cell.props.children) : "") : [];
  return <Columns.Provider value={labels}>
        <div className="data-table-shell w-full overflow-x-auto">
          <table ref={ref} role="table" data-mobile-cards={mobileCards && labels.length > 0 ? "true" : undefined} data-mobile-columns={mobileColumns === 3 ? "3" : "2"} className={cn("data-table w-full caption-bottom text-sm dark:text-gray-100", className)} {...props}>
            {children}
          </table>
        </div>
      </Columns.Provider>;
});
Table.displayName = "Table";
export const TableHeader = forwardRef(({
  className,
  ...props
}, ref) => <thead ref={ref} role="rowgroup" className={cn("[&_tr]:border-b [&_tr]:border-gray-100 dark:[&_tr]:border-gray-800", className)} {...props} />);
TableHeader.displayName = "TableHeader";
export const TableBody = forwardRef(({
  className,
  ...props
}, ref) => <tbody role="rowgroup" ref={ref} className={cn("[&_tr:last-child]:border-0", className)} {...props} />);
TableBody.displayName = "TableBody";
export const TableRow = forwardRef(({
  className,
  children,
  ...props
}, ref) => {
  useUiLanguage();
  const labels = useContext(Columns);
  let column = 0;
  return <tr ref={ref} role="row" className={cn("border-b border-gray-100/80 transition-colors hover:bg-gray-50/70 dark:border-gray-800 dark:hover:bg-gray-800/40 data-[state=selected]:bg-primary-50 dark:data-[state=selected]:bg-primary-900/20", className)} {...props}>
      {Children.toArray(children).map(cell => {
      if (!isValidElement(cell) || cell.type !== TableCell) return cell;
      const label = labels[column];
      column += Number(cell.props.colSpan || 1);
      return cloneElement(cell, {
        "data-label": cell.props["data-label"] ?? (cell.props.colSpan > 1 ? undefined : label)
      });
    })}
    </tr>;
});
TableRow.displayName = "TableRow";
export const TableHead = forwardRef(({
  className,
  ...props
}, ref) => <th ref={ref} scope="col" role="columnheader" className={cn("h-12 whitespace-nowrap bg-slate-50 px-5 text-left align-middle text-xs font-semibold text-slate-600 dark:bg-gray-800/60 dark:text-gray-300 [&:has([role=checkbox])]:pr-0", className)} {...props} />);
TableHead.displayName = "TableHead";
export const TableCell = forwardRef(({
  className,
  ...props
}, ref) => <td ref={ref} role="cell" className={cn("px-5 py-4 align-middle [&:has([role=checkbox])]:pr-0", className)} {...props} />);
TableCell.displayName = "TableCell";

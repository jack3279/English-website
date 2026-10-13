import { cn } from "../lib/cn.js";

export function Table({ headers, rows, keyOf, className }) {
  return (
    <div
      className={cn(
        "overflow-x-auto bg-white border border-gray-200 rounded-lg dark:bg-gray-900 dark:border-gray-800 ",
        className,
      )}
    >
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b border-gray-200 dark:bg-gray-800/40 dark:border-gray-800 ">
          <tr>
            {headers.map((h, i) => (
              <th
                key={i}
                className="px-4 py-3 text-left font-medium text-gray-700 dark:text-gray-300 "
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={keyOf ? keyOf(r) : i}
              className="border-b border-gray-100 last:border-0 dark:border-gray-800 "
            >
              {r.map((c, j) => (
                <td key={j} className="px-4 py-3 text-gray-900 dark:text-gray-100 ">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

import { Link } from "react-router-dom";
import { Grid2X2, ChevronRight } from "lucide-react";
import { getNavigation } from "../../layout/Navigation.jsx";
import { PageHeader } from "../../components/PageHeader.jsx";
import { Card } from "../../components/ui/card.jsx";
function Feature({ item }) {
  const Icon = item.icon;
  if (item.items)
    return (
      <details className="border-t border-gray-100 dark:border-gray-800">
        <summary className="flex cursor-pointer items-center gap-3 p-4 font-medium">
          <Icon className="h-4 w-4 text-primary-700 dark:text-primary-300 " />
          {item.label}
        </summary>
        <div className="pl-4">
          {item.items.map((child) => (
            <Feature key={child.label} item={child} />
          ))}
        </div>
      </details>
    );
  return (
    <Link
      to={item.to}
      className="flex min-h-14 items-center gap-3 border-t border-gray-100 p-4 first:border-0 dark:border-gray-800"
    >
      <Icon className="h-4 w-4 shrink-0 text-primary-700 dark:text-primary-300 " />
      <span className="text-sm font-medium">{item.label}</span>
      <ChevronRight className="ml-auto h-4 w-4 text-gray-500 dark:text-gray-400 " />
    </Link>
  );
}
export default function AllFeaturesPage() {
  const nav = getNavigation("admin"),
    primary = nav.filter((item) => !item.items),
    groups = nav.filter((item) => item.items);
  return (
    <div className="min-h-full admin-mobile-page">
      <PageHeader title="全部功能" subtitle="常用操作与机构管理" icon={Grid2X2} back="/admin" />
      <main className="page-body grid items-start gap-4 md:grid-cols-2">
        <section>
          <h2 className="mb-2 px-1 text-sm font-semibold">日常工作</h2>
          <Card className="overflow-hidden">
            {primary.map((item) => (
              <Feature key={item.label} item={item} />
            ))}
            <Feature item={{ label: "教务待办", to: "/admin/operations", icon: Grid2X2 }} />
            <Feature item={{ label: "收到的消息", to: "/inbox", icon: Grid2X2 }} />
          </Card>
        </section>
        {groups.map((group) => (
          <section key={group.label}>
            <h2 className="mb-2 px-1 text-sm font-semibold">{group.label}</h2>
            <Card className="overflow-hidden">
              {group.items.map((item) => (
                <Feature key={item.label} item={item} />
              ))}
            </Card>
          </section>
        ))}
      </main>
    </div>
  );
}

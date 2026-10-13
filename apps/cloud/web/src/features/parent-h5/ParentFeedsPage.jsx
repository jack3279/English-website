import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { MessageSquare } from "lucide-react";
import { PageHeader } from "../../components/PageHeader.jsx";
import { Card } from "../../components/ui/card.jsx";
import { Button } from "../../components/ui/button.jsx";
import { Segmented } from "../../components/ui/segmented.jsx";
import { http } from "../../lib/http.js";
import FeedList from "./FeedList.jsx";
export default function ParentFeedsPage() {
  const [params] = useSearchParams(),
    requested = params.get("studentId");
  const query = useQuery({
    queryKey: ["my-students"],
    queryFn: async () => (await http("/students?pageSize=100")).data || [],
  });
  const [id, setId] = useState("");
  const students = query.data || [];
  useEffect(() => {
    if (students.length && !students.some((s) => s.id === id))
      setId(students.some((s) => s.id === requested) ? requested : students[0].id);
  }, [students, id, requested]);
  return (
    <div>
      <PageHeader title="上课记录" subtitle="查看点名结果与本节课上课内容" icon={MessageSquare} />
      <main className="page-body space-y-4">
        {students.length > 1 && (
          <Segmented
            value={id}
            onChange={setId}
            items={students.map((s) => ({ key: s.id, label: s.full_name }))}
          />
        )}
        {query.isPending ? (
          <Card className="p-6">正在读取孩子资料…</Card>
        ) : query.isError ? (
          <Card className="p-6">
            <p role="alert">资料读取失败</p>
            <Button onClick={() => query.refetch()} variant="outline">
              重试
            </Button>
          </Card>
        ) : !students.length ? (
          <Card className="p-6">尚未关联孩子，请联系教务。</Card>
        ) : (
          id && <FeedList studentId={id} />
        )}
      </main>
    </div>
  );
}

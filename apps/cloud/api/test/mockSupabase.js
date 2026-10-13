// 测试用 mock supabase client. 用 deep proxy 让任意 .from(t).op().op() 都返回 thenable.
// 测试通过 setMockResult(r) 设单个 result, 或 setMockResults([r1, r2]) 排队, 每次 then 弹一个.

let queue = [{ data: null, error: null }];
let mode = "queue"; // "single" | "queue"
const queryLog = [];

function setMockResult(r) {
  mode = "single";
  queue = [r];
}

function setMockResults(rs) {
  mode = "queue";
  queue = [...rs];
}

function resetMock() {
  mode = "queue";
  queue = [{ data: null, error: null }];
  queryLog.length = 0;
}

function getQueryLog() {
  return queryLog;
}

function popResult() {
  if (mode === "single") return queue[0];
  if (queue.length <= 1) return queue[queue.length - 1];
  return queue.shift();
}

function makeChainable(table) {
  const record = { table, ops: [] };
  queryLog.push(record);
  const fn = () => chain;
  const chain = new Proxy(fn, {
    get(_t, prop) {
      if (prop === "then") {
        return (onFulfilled, onRejected) =>
          Promise.resolve(popResult()).then(onFulfilled, onRejected);
      }
      if (prop === "catch") {
        return (onRejected) => Promise.resolve(popResult()).catch(onRejected);
      }
      if (prop === Symbol.iterator || prop === Symbol.toPrimitive) return undefined;
      return (...args) => {
        record.ops.push({ op: prop, args });
        return chain;
      };
    },
    apply() {
      return chain;
    },
  });
  return chain;
}

const mockClient = new Proxy(
  {},
  {
    get(_t, prop) {
      if (prop === "auth") {
        return new Proxy(
          {},
          {
            get(_t, _op) {
              return (..._args) => Promise.resolve(popResult());
            },
          },
        );
      }
      if (prop === "rpc" || prop === "storage" || prop === "realtime") {
        return (...args) => {
          queryLog.push({ table: args[0], ops: [{ op: prop, args }] });
          return Promise.resolve(popResult());
        };
      }
      return (table) => makeChainable(table);
    },
  },
);

module.exports = { mockClient, setMockResult, setMockResults, resetMock, getQueryLog };

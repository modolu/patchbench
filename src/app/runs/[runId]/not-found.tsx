import { RunUnavailable } from "@/components/pb/run-unavailable";

export default function RunNotFound() {
  return <RunUnavailable title="Run not found" message="No persisted PatchBench run matches this ID. Run IDs look like run-20260926073526-aab88e." />;
}

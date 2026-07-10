import { useCallback, useState } from "react";
import type { Job } from "../api/client";
import { watchJob } from "../api/client";

export function useJobStatus() {
  const [jobMsg, setJobMsg] = useState<string | null>(null);
  const [jobMsgWarn, setJobMsgWarn] = useState(false);

  const trackJob = useCallback(
    (jobId: string, handlers: {
      onRunning?: (job: Job) => void;
      onCompleted?: (job: Job) => void;
      onFailed?: (job: Job) => void;
    }) => {
      watchJob(jobId, (job) => {
        if (job.status === "running") {
          setJobMsgWarn(false);
          handlers.onRunning?.(job);
        }
        if (job.status === "completed") {
          handlers.onCompleted?.(job);
        }
        if (job.status === "failed") {
          setJobMsgWarn(false);
          setJobMsg(`Erreur : ${job.error}`);
          handlers.onFailed?.(job);
        }
      });
    },
    []
  );

  return { jobMsg, setJobMsg, jobMsgWarn, setJobMsgWarn, trackJob };
}

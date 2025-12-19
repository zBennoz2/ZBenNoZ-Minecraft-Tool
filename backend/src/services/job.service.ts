import { randomUUID } from 'crypto'

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed'

export interface JobInfo {
  id: string
  status: JobStatus
  progress: number
  message?: string
  error?: string
  createdAt: string
  updatedAt: string
}

export class JobService {
  private jobs = new Map<string, JobInfo>()

  createJob(): JobInfo {
    const now = new Date().toISOString()
    const job: JobInfo = {
      id: randomUUID(),
      status: 'pending',
      progress: 0,
      createdAt: now,
      updatedAt: now,
    }
    this.jobs.set(job.id, job)
    return job
  }

  updateJob(id: string, partial: Partial<JobInfo>) {
    const existing = this.jobs.get(id)
    if (!existing) return null
    const updated: JobInfo = { ...existing, ...partial, updatedAt: new Date().toISOString() }
    this.jobs.set(id, updated)
    return updated
  }

  getJob(id: string): JobInfo | null {
    return this.jobs.get(id) ?? null
  }
}

export const jobService = new JobService()

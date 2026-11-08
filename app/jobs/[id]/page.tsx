'use client'

import { use } from 'react'

import JobDetailView from '@/components/career/JobDetailView'
import PageHeader from '@/components/PageHeader'

export default function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  return (
    <>
      <PageHeader title="Job" backTo="/jobs" />
      <JobDetailView id={Number(id)} />
    </>
  )
}

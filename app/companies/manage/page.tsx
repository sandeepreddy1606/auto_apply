'use client'

import { useEffect } from 'react'

import { useNavigate } from '@/components/Navigation'

/** Old address of the Companies page; kept so bookmarks still work. */
export default function CompaniesManageRedirect() {
  const navigate = useNavigate()
  useEffect(() => navigate('/companies'), [navigate])
  return null
}

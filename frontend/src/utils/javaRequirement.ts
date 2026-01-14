import { JavaCandidate, JavaRequirement } from '../api'

export const formatJavaRequirement = (requirement?: JavaRequirement) => {
  if (!requirement) return 'Java'
  return requirement.mode === 'exact' ? `Java ${requirement.major}` : `Java ${requirement.major}+`
}

export const formatJavaCandidateList = (candidates?: JavaCandidate[]) => {
  if (!candidates || candidates.length === 0) {
    return ['No Java runtimes detected.']
  }
  return candidates.map((candidate) => {
    const sourceLabel = candidate.source === 'managed' ? 'Managed' : 'System'
    return `${sourceLabel}: Java ${candidate.major} at ${candidate.path}`
  })
}

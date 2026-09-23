export type OaisRequest = {
  serviceType: string
  payload: Record<string, unknown>
}

export type OaisResult = {
  externalReference?: string
  status?: string
  response?: unknown
}

/**
 * Boundary for the official OAIS transport.
 * The concrete endpoint/authentication must come from the service-specific
 * NCE specification; no government endpoint is invented here.
 */
export function createOaisRequest(serviceType:string,payload:Record<string,unknown>):OaisRequest {
  if(!serviceType) throw new Error('serviceType is required')
  return {serviceType,payload}
}

export async function sendToOais(_request:OaisRequest):Promise<OaisResult> {
  throw new Error('OAIS transport is not configured: provide the official service endpoint and authentication contract.')
}

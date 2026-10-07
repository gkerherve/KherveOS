// Small helpers for writing tool argument schemas in the manifests
// (plain TypeScript, no "@/" imports: Node runs the manifest tests).

import type { Schema } from '../appToolsCore.ts'

export const str = (description: string): Schema => ({ type: 'string', description })
export const int = (description: string): Schema => ({ type: 'integer', description })
export const num = (description: string): Schema => ({ type: 'number', description })
export const bool = (description: string): Schema => ({ type: 'boolean', description })
export const oneOf = (values: readonly string[], description: string): Schema => ({ type: 'string', enum: [...values], description })
export const object = (properties: Record<string, Schema>, required: string[] = []): Schema => ({ type: 'object', properties, required })

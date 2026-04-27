import type { ProductFormState, ProductFormTab } from '@/lib/stores/product'

export type ProductDraftValidation = {
	hasValidName: boolean
	hasValidDescription: boolean
	hasValidCategory: boolean
	hasValidImages: boolean
	hasValidShipping: boolean
	allRequiredFieldsValid: boolean
	issues: string[]
	issuesByTab: Partial<Record<ProductFormTab, string[]>>
	firstIncompleteTab: ProductFormTab
}

export function validateProductDraft({
	state,
	resolvedShippingRefs,
	isShippingFetched,
}: {
	state: ProductFormState
	resolvedShippingRefs: Set<string>
	isShippingFetched: boolean
}): ProductDraftValidation {
	const hasValidName = state.name.trim().length > 0
	const hasValidDescription = state.description.trim().length > 0
	const hasValidCategory = true
	const hasValidImages = state.images.length > 0
	const hasValidShipping = state.shippings.some(
		(ship) => ship.shippingRef && (!isShippingFetched || resolvedShippingRefs.has(ship.shippingRef)),
	)

	const issuesByTab: Partial<Record<ProductFormTab, string[]>> = {}
	const addIssue = (tab: ProductFormTab, issue: string) => {
		issuesByTab[tab] = [...(issuesByTab[tab] ?? []), issue]
	}

	if (!hasValidName) addIssue('name', 'Product name is required')
	if (!hasValidDescription) addIssue('name', 'Description is required')
	if (!hasValidImages) addIssue('images', 'At least one image is required')
	if (!hasValidShipping) addIssue('shipping', 'At least one shipping option is required')

	const issues = (['name', 'detail', 'spec', 'category', 'images', 'shipping'] as ProductFormTab[]).flatMap((tab) => issuesByTab[tab] ?? [])
	const allRequiredFieldsValid = issues.length === 0
	const firstIncompleteTab =
		(['name', 'detail', 'spec', 'category', 'images', 'shipping'] as ProductFormTab[]).find((tab) => issuesByTab[tab]?.length) ?? 'shipping'

	return {
		hasValidName,
		hasValidDescription,
		hasValidCategory,
		hasValidImages,
		hasValidShipping,
		allRequiredFieldsValid,
		issues,
		issuesByTab,
		firstIncompleteTab,
	}
}

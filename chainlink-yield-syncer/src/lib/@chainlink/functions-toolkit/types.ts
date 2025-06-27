export enum ReturnType {
  uint = 'uint256',
  // eslint-disable-next-line @typescript-eslint/no-duplicate-enum-values
  uint256 = 'uint256',
  int = 'int256',
  // eslint-disable-next-line @typescript-eslint/no-duplicate-enum-values
  int256 = 'int256',
  string = 'string',
  bytes = 'bytes',
}

export enum FulfillmentCode {
  FULFILLED = 0, // Indicates that calling the consumer contract's handleOracleFulfill method was successful
  USER_CALLBACK_ERROR = 1, // Indicates that the consumer contract's handleOracleFulfill method reverted
  INVALID_REQUEST_ID = 2, // Indicates a duplicate response to a request.  This is not an error, but the response is ignored
  COST_EXCEEDS_COMMITMENT = 3, // Indicates that the request was not fulfilled because the cost of fulfillment is higher than the estimated cost due to an increase in gas prices
  INSUFFICIENT_GAS_PROVIDED = 4, // Internal error
  SUBSCRIPTION_BALANCE_INVARIANT_VIOLATION = 5, // Internal error
  INVALID_COMMITMENT = 6, // Internal error
}

export type FunctionsResponse = {
  requestId: string // Request ID of the fulfilled request represented as a bytes32 hex string
  subscriptionId: number // Subscription ID billed for request
  totalCostInJuels: bigint // Actual cost of request in Juels (1,000,000,000,000,000,000 (1e18) Juels are equal to 1 LINK)
  responseBytesHexstring: string // Response bytes sent to client contract represented as a hex string ("0x" if no response)
  errorString: string // Error bytes sent to client contract interpreted as a UTF-8 string ("" if no error)
  returnDataBytesHexstring: string // Data returned by consumer contract's handleOracleFulfillment method represented as a hex string
  fulfillmentCode: FulfillmentCode // Indicates whether the request was fulfilled successfully or not
}

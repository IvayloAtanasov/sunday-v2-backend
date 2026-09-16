/**
 * Link to a transaction in the chain explorer, or undefined when EXPLORER_URL is not set.
 *
 * Optional on purpose: a missing explorer costs a nicer log line, not a run.
 */
export const txLink = (explorerUrl: string | undefined, transactionHash: string): string | undefined =>
  explorerUrl
    ? `${explorerUrl.replace(/\/+$/, '')}/tx/${transactionHash}`
    : undefined

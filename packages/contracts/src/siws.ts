// Sign-In With Solana message text. Must stay byte-identical to
// createSignInMessageText in @solana/wallet-standard-util (pinned by siws.test.ts),
// because wallets render the message with that function during MWA `signIn`.
// The server verifies by rebuilding the text from its own stored nonce record and
// requiring exact equality with the signed bytes, so no field can come from the client.

export type SiwsFields = {
  domain: string;
  address: string;
  statement?: string;
  uri?: string;
  version?: string;
  chainId?: string;
  nonce?: string;
  issuedAt?: string;
  expirationTime?: string;
};

export function buildSiwsMessage(input: SiwsFields): string {
  let message = `${input.domain} wants you to sign in with your Solana account:\n${input.address}`;
  if (input.statement) message += `\n\n${input.statement}`;
  const fields: string[] = [];
  if (input.uri) fields.push(`URI: ${input.uri}`);
  if (input.version) fields.push(`Version: ${input.version}`);
  if (input.chainId) fields.push(`Chain ID: ${input.chainId}`);
  if (input.nonce) fields.push(`Nonce: ${input.nonce}`);
  if (input.issuedAt) fields.push(`Issued At: ${input.issuedAt}`);
  if (input.expirationTime) fields.push(`Expiration Time: ${input.expirationTime}`);
  if (fields.length) message += `\n\n${fields.join('\n')}`;
  return message;
}

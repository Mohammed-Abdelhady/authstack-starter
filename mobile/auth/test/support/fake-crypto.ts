export class FakeCrypto {
  private randomFill = 1;
  readonly randomLengths: number[] = [];
  hashOverride: ((bytes: Uint8Array) => Uint8Array) | undefined;

  async randomBytes(length: number): Promise<Uint8Array> {
    this.randomLengths.push(length);
    const bytes = new Uint8Array(length).fill(this.randomFill);
    this.randomFill += 1;
    return bytes;
  }

  async sha256(bytes: Uint8Array): Promise<Uint8Array> {
    if (this.hashOverride) return this.hashOverride(bytes);
    let checksum = 0;
    for (const [index, byte] of bytes.entries()) {
      checksum = (checksum + byte * (index + 1)) % 251;
    }
    return new Uint8Array(32).fill(checksum);
  }
}

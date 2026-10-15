import type { UnitOfWork } from '../../common/persistence/unit-of-work';
import type { FreshProofInput, FreshProofMail } from './types/fresh-proof';

/** Defaults to the five-minute session/act check; plan 4 wires strict mutations to it. */
export abstract class FreshProofCheck {
  abstract isFresh(
    unitOfWork: UnitOfWork,
    input: FreshProofInput,
  ): Promise<boolean>;
}

/** Defaults to core SMTP proof mail; plan 4 supplies the proof issuance/consumption workflow. */
export abstract class FreshProofSender {
  abstract sendProofCode(mail: FreshProofMail): Promise<void>;
}

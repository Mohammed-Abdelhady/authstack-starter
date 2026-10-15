import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { ADDRESS_CLAIM_KIND } from '../../address-ledger';
import { AddressClaimKind } from '../../types/address-ledger';

@Schema({ collection: 'addressclaims', versionKey: false })
export class AddressClaim {
  @Prop({ type: String, required: true })
  _id!: string;

  @Prop({
    type: String,
    enum: Object.values(ADDRESS_CLAIM_KIND),
    required: true,
  })
  kind!: AddressClaimKind;

  @Prop({ type: String, required: true })
  owner!: string;

  @Prop({ type: Date, required: true })
  lapsesAt!: Date;
}

export type AddressClaimDocument = HydratedDocument<AddressClaim>;
export const AddressClaimSchema = SchemaFactory.createForClass(AddressClaim);

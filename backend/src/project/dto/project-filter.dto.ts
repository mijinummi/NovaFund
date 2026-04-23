import { InputType, Field } from '@nestjs/graphql';
import { StringFilterInput, IntFilterInput, FloatFilterInput, DateTimeFilterInput } from './filter-inputs.dto';

@InputType()
export class ProjectFilterInput {
  @Field(() => StringFilterInput, { nullable: true })
  title?: StringFilterInput;

  @Field(() => StringFilterInput, { nullable: true })
  description?: StringFilterInput;

  @Field(() => StringFilterInput, { nullable: true })
  category?: StringFilterInput;

  @Field(() => StringFilterInput, { nullable: true })
  status?: StringFilterInput;

  @Field(() => StringFilterInput, { nullable: true })
  creatorId?: StringFilterInput;

  @Field(() => FloatFilterInput, { nullable: true })
  goal?: FloatFilterInput;

  @Field(() => FloatFilterInput, { nullable: true })
  currentFunds?: FloatFilterInput;

  @Field(() => DateTimeFilterInput, { nullable: true })
  deadline?: DateTimeFilterInput;

  @Field(() => DateTimeFilterInput, { nullable: true })
  createdAt?: DateTimeFilterInput;
}

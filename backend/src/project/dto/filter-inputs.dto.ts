import { InputType, Field, Int, Float } from '@nestjs/graphql';

@InputType()
export class StringFilterInput {
  @Field({ nullable: true })
  equals?: string;

  @Field({ nullable: true })
  contains?: string;

  @Field(() => [String], { nullable: true })
  in?: string[];

  @Field({ nullable: true })
  not?: string;
}

@InputType()
export class IntFilterInput {
  @Field({ nullable: true })
  equals?: number;

  @Field({ nullable: true })
  gt?: number;

  @Field({ nullable: true })
  gte?: number;

  @Field({ nullable: true })
  lt?: number;

  @Field({ nullable: true })
  lte?: number;

  @Field(() => [Int], { nullable: true })
  in?: number[];
}

@InputType()
export class FloatFilterInput {
  @Field({ nullable: true })
  equals?: number;

  @Field({ nullable: true })
  gt?: number;

  @Field({ nullable: true })
  gte?: number;

  @Field({ nullable: true })
  lt?: number;

  @Field({ nullable: true })
  lte?: number;

  @Field(() => [Float], { nullable: true })
  in?: number[];
}

@InputType()
export class DateTimeFilterInput {
  @Field({ nullable: true })
  equals?: string;

  @Field({ nullable: true })
  gt?: string;

  @Field({ nullable: true })
  gte?: string;

  @Field({ nullable: true })
  lt?: string;

  @Field({ nullable: true })
  lte?: string;

  @Field(() => [String], { nullable: true })
  in?: string[];
}

import mongoose from 'mongoose';

export const assertValidObjectId = (id: string, label = 'ID') => {
  if (!id || !mongoose.Types.ObjectId.isValid(id)) {
    throw new Error(`Invalid ${label}`);
  }
  return id;
};

export const buildOwnedIdFilter = (userId: string, id: string) => ({
  _id: assertValidObjectId(id),
  userId,
});

type FindOneCapable = {
  findOne: (filter: Record<string, unknown>) => any;
};

type FindOneAndUpdateCapable = {
  findOneAndUpdate: (
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options?: Record<string, unknown>,
  ) => any;
};

type DeleteOneCapable = {
  deleteOne: (filter: Record<string, unknown>) => any;
};

export const findOwnedById = (
  model: FindOneCapable,
  userId: string,
  id: string,
) => model.findOne(buildOwnedIdFilter(userId, id));

export const findOwnedByIdAndUpdate = (
  model: FindOneAndUpdateCapable,
  userId: string,
  id: string,
  update: Record<string, unknown>,
  options?: Record<string, unknown>,
) => model.findOneAndUpdate(buildOwnedIdFilter(userId, id), update, options);

export const deleteOwnedById = (
  model: DeleteOneCapable,
  userId: string,
  id: string,
) => model.deleteOne(buildOwnedIdFilter(userId, id));

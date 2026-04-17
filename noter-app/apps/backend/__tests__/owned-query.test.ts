import {
  assertValidObjectId,
  buildOwnedIdFilter,
  deleteOwnedById,
  findOwnedById,
  findOwnedByIdAndUpdate,
} from '../src/utils/ownedQuery';

describe('owned query helpers', () => {
  const validId = '507f191e810c19729de860ea';

  it('builds owned filters with validated ids', () => {
    expect(buildOwnedIdFilter('user-1', validId)).toEqual({
      _id: validId,
      userId: 'user-1',
    });
  });

  it('throws on invalid object ids', () => {
    expect(() => assertValidObjectId('bad-id')).toThrow('Invalid ID');
    expect(() => assertValidObjectId('', 'noteId')).toThrow('Invalid noteId');
  });

  it('routes find/update/delete through the same owned filter', () => {
    const findOne = jest.fn();
    const findOneAndUpdate = jest.fn();
    const deleteOne = jest.fn();

    findOwnedById({ findOne }, 'user-1', validId);
    findOwnedByIdAndUpdate({ findOneAndUpdate }, 'user-1', validId, { $set: { title: 'x' } }, { new: true });
    deleteOwnedById({ deleteOne }, 'user-1', validId);

    expect(findOne).toHaveBeenCalledWith({ _id: validId, userId: 'user-1' });
    expect(findOneAndUpdate).toHaveBeenCalledWith(
      { _id: validId, userId: 'user-1' },
      { $set: { title: 'x' } },
      { new: true },
    );
    expect(deleteOne).toHaveBeenCalledWith({ _id: validId, userId: 'user-1' });
  });
});

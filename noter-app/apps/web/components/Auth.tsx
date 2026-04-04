import React, { useState } from 'react';
import { useStore } from '../stores/useStore';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { FaCog } from 'react-icons/fa';
import ApiUrlModal from './ApiUrlModal';

export default function Auth() {
  const login = useStore((state) => state.login);
  const register = useStore((state) => state.register);
  const { t } = useTranslation();
  const [isLogin, setIsLogin] = useState(true);
  const [serverError, setServerError] = useState('');
  const [isApiModalOpen, setIsApiModalOpen] = useState(false);
  
  const { register: formRegister, handleSubmit, formState: { errors, isSubmitting }, reset } = useForm({
    defaultValues: {
      username: '',
      password: ''
    }
  });

  const onSubmit = async (data: any) => {
    setServerError('');
    try {
      if (isLogin) {
        await login(data.username, data.password);
      } else {
        await register(data.username, data.password);
      }
    } catch (err: any) {
      setServerError(err.message || t('errors.generic'));
    }
  };
  
  const toggleMode = () => {
      setIsLogin(!isLogin);
      setServerError('');
      reset();
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-100 dark:bg-gray-900">
      <div className="p-8 bg-white dark:bg-gray-800 rounded shadow-md w-96 relative">
        <button
          onClick={() => setIsApiModalOpen(true)}
          className="absolute top-3 right-3 p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700"
          aria-label={t('settings.apiSettings')}
          title={t('settings.apiSettings')}
          type="button"
        >
          <FaCog />
        </button>
        <h2 className="text-2xl font-bold mb-6 text-gray-800 dark:text-gray-100 text-center">
          {isLogin ? t('auth.login') : t('auth.register')}
        </h2>
        {serverError && (
          <div className="mb-4 p-2 bg-red-100 text-red-600 text-sm rounded border border-red-200">
            {serverError}
          </div>
        )}
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('auth.username')}
            </label>
            <input
              type="text"
              {...formRegister('username', { required: t('validation.required') })}
              className={`w-full p-2 border rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 outline-none transition-shadow ${errors.username ? 'border-red-500 focus:ring-2 focus:ring-red-500' : 'border-gray-300 dark:border-gray-600 focus:ring-2 focus:ring-blue-500'}`}
            />
            {errors.username && <p className="text-red-500 text-xs mt-1">{errors.username.message as string}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('auth.password')}
            </label>
            <input
              type="password"
              {...formRegister('password', { 
                  required: t('validation.required'),
                  minLength: {
                      value: 6,
                      message: t('validation.passwordLength')
                  }
              })}
              className={`w-full p-2 border rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 outline-none transition-shadow ${errors.password ? 'border-red-500 focus:ring-2 focus:ring-red-500' : 'border-gray-300 dark:border-gray-600 focus:ring-2 focus:ring-blue-500'}`}
            />
             {errors.password && <p className="text-red-500 text-xs mt-1">{errors.password.message as string}</p>}
          </div>
          <button
            type="submit"
            disabled={isSubmitting}
            className={`w-full py-2 px-4 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors ${isSubmitting ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            {isSubmitting ? t('auth.loading') : (isLogin ? t('auth.login') : t('auth.register'))}
          </button>
        </form>
        <div className="mt-4 text-center">
          <button
            onClick={toggleMode}
            className="text-sm text-blue-600 hover:underline dark:text-blue-400"
          >
            {isLogin ? t('auth.noAccount') : t('auth.haveAccount')}
          </button>
        </div>
      </div>
      <ApiUrlModal isOpen={isApiModalOpen} onClose={() => setIsApiModalOpen(false)} />
    </div>
  );
}

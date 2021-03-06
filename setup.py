# -*- coding: utf-8 -*-
from setuptools import setup, find_packages

with open('requirements.txt') as f:
	install_requires = f.read().strip().split('\n')

# get version from __version__ variable in arkan_pos/__init__.py
from arkan_pos import __version__ as version

setup(
	name='arkan_pos',
	version=version,
	description='POS customizations for arkan',
	author='Havenir Solutions',
	author_email='support@havenir.com',
	packages=find_packages(),
	zip_safe=False,
	include_package_data=True,
	install_requires=install_requires
)
